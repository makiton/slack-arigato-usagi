const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { WebClient } = require('@slack/client');
const moment = require('moment');

const slack = new WebClient(functions.config().slack.token);

admin.initializeApp(functions.config().firebase);
const db = admin.firestore();
db.settings({timestampsInSnapshots: true});

var listeners = {
  reaction_added: async (event) => {
    console.log('Reaction added:', event);
    // ignore any other reaction
    if (event.reaction !== "arigato") {
      return;
    }

    message = event.item

    try {
      const fromUser = await getUser(event.user)
      console.log("from user:", fromUser);

      const { text, userID } = await getMessage(message.channel, message.ts);
      console.log("toUserID:", userID);
      console.log("text:", text);

      const toUser = await getUser(userID);
      console.log("to user:", toUser);

      const ref = await db.collection('arigato-messages').add({
        to_user: toUser,
        from_user: fromUser,
        message: text,
        timestamp: message.ts,
      });

      console.log("datastore id:", ref.id);

      const res = await slack.reactions.add({
        name: "arigato-usagi",
        channel: message.channel,
        timestamp: message.ts
      });
      console.log("reaction response:", res);
    } catch(e) {
      if (e.data !== undefined && e.data.error === 'already_reacted') {
        return;
      }
      console.error(e);
    }
  }
}

function getMessage(ch, ts) {
  return new Promise((resolve, reject) => {
    slack.conversations.history({
      channel: ch,
      latest: ts,
      limit: 1,
      inclusive: true
    }, (err, res) => {
      if (err) {
        console.log(err);
        return reject(err);
      }
      const text = res.messages[0].text;
      const userID = res.messages[0].user;
      return resolve({text, userID});
    });
  });
}

function getUser(userID) {
  return new Promise((resolve, reject) => {
    slack.users.info({ user: userID }, (err, res) => {
      if (err) {
        console.log(err);
        return reject(err);
      }
      return resolve(res.user.name);
    });
  });
}

exports.hook_reactions = functions.https.onRequest((request, response) => {
  if (request.body.type === "url_verification") {
    response.send(request.body.challenge);
    return;
  }

  if (request.body.type !== "event_callback") {
    response.send("ignore");
    return;
  }

  if (listeners[request.body.event.type]) {
    listeners[request.body.event.type](request.body.event).then(() => {
      return response.send("ok");
    }).catch((e) => {
      console.error(e);
    });
  } else {
    console.log("Event is discarded:", request.body.event.type);
  }
});

async function sumUp() {
  const from = moment().subtract(1, 'month');
  const now = moment();
  const ref = db.collection('arigato-messages');
  const rows = await ref.where('timestamp', ">=", from.valueOf().toString()).get();

  let arigating = {}, arigated = {}, total = 0;
  rows.forEach(doc => {
    // console.log(doc.id, "=>", doc.data());
    const { from_user, to_user } = doc.data();
    if (from_user === to_user) {
      return;
    }
    if (!arigating[from_user]) {
      arigating[from_user] = 0;
    }
    arigating[from_user]++;

    if (!arigated[to_user]) {
      arigated[to_user] = 0;
    }
    arigated[to_user]++;

    ++total
  });
  let arigatingList = [], arigatedList = [];
  for (var k in arigating) {
    arigatingList.push({ name: k, count: arigating[k] });
  }
  arigatingList.sort((a, b) => {
    return b.count - a.count;
  });
  for (k in arigated) {
    arigatedList.push({ name: k, count: arigated[k] });
  }
  arigatedList.sort((a, b) => {
    return b.count - a.count;
  });

  const resultMessage = `集計期間: ${from.format('YYYY/MM/DD')}-${now.format('YYYY/MM/DD')}` +
    `\n\ntotal: ${total}:arigato:` +
    "\n\narigated:\n" +
    arigatedList.slice(0, 3).map(v => {
      return `  ${v.name}: ${v.count}`
    }).join("\n") +
    "\n\narigating:\n" +
    arigatingList.slice(0, 3).map(v => {
      return `  ${v.name}: ${v.count}`
    }).join("\n");
  const res = await slack.chat.postMessage({
    channel: "#general",
    text: resultMessage
  });
  console.log("post message response: ", res);
  console.log("arigated: ", arigatedList);
  console.log("arigating: ", arigatingList);
  console.log("total: ", total);
}

exports.sum_up = functions.https.onRequest((request, response) => {
  sumUp().then(() => {
    response.send("ok");
    return;
  }).catch(e => {
    console.error(e);
  });
});
