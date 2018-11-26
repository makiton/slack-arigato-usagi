const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { WebClient } = require('@slack/client');

const slack = new WebClient(functions.config().slack.token);

admin.initializeApp(functions.config().firebase);
const db = admin.firestore();

var listeners = {
  reaction_added: async (event, callback) => {
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
    return response.send(request.body.challenge);
  }

  if (request.body.type !== "event_callback") {
    return response.send("ignore");
  }

  if (listeners[request.body.event.type]) {
    listeners[request.body.event.type](request.body.event, () => {
      response.send("ok")
    });
  } else {
    console.log("Event is discarded:", request.body.event.type);
  }
  return;
});

