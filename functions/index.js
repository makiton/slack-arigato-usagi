const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { WebClient } = require('@slack/client');

const slack = new WebClient(functions.config().slack.token);

admin.initializeApp(functions.config().firebase);
const db = admin.firestore();

var listeners = {
  reaction_added: (event) => {
    console.log('Reaction added:', event);
    // ignore any other reaction
    if (event.reaction !== "arigato") {
      return;
    }

    message = event.item

    let text, toUser, fromUser;
    getUser(event.user).then((_fromUser) => {
      console.log("from user:", _fromUser);
      fromUser = _fromUser;

      return getMessage(message.channel, message.ts)
    }).then(({_text, _userID}) => {
      console.log("toUserID:", _userID);
      console.log("text:", _text);

      text = _text;
      return getUser(_userID);
    }).then((_toUser) => {
      console.log("to user:", _toUser);
      toUser = _toUser;

      return db.collection('arigato-messages').add({
        to_user: toUser,
        from_user: fromUser,
        message: text,
        timestamp: message.ts,
      });
    }).then((ref) => {
      console.log("datastore id:", ref.id);

      return slack.reactions.add({
        name: "arigato-usagi",
        channel: message.channel,
        timestamp: message.ts
      })
    }).then((res) => {
      console.log("reaction response:", res);
      return;
    }).catch((e) => {
      // ignore already_reacted error
      if (e.data !== undefined && e.data.error === 'already_reacted') {
        return;
      }
      console.log(e);
    });
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
      const _text = res.messages[0].text;
      const _userID = res.messages[0].user;
      return resolve({_text, _userID});
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
    listeners[request.body.event.type](request.body.event);
  } else {
    console.log("Event is discarded:", request.body.event.type);
  }
  return response.send("ok");
});

