const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const app = express();
const PORT = process.env.PORT || 3000;

let gmail;


const SCOPES = ['https://mail.google.com/',
                'https://www.googleapis.com/auth/gmail.readonly',
                'https://www.googleapis.com/auth/gmail.send',
                'https://www.googleapis.com/auth/gmail.labels'];


const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');


const loadSavedCredentialsIfExist= async ()=> {
    try {
      const content = await fs.readFile(TOKEN_PATH);
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
};


const saveCredentials =async  (client)=> {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
};


const authorize = async  ()=> {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
      return client;
    }
    client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
      await saveCredentials(client);
    }
    return client;
};


const getUnrepliedEmailsId = async ()=>{
    try {
        // Fetch the list of unread emails
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: 'in:inbox is:unread -in:chats -from:me'
        });

        const messages = response.data.messages;
        return messages || [];
    } catch (error) {
        console.error("Error while fetching UnrepliedEmails: ",error);
        return [];
    }
    
};

// Function to send a reply to an email
const sendReply = async (messId)=>{
    const response = await gmail.users.messages.get({
        userId: 'me',
        id: messId,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From'],
    });
    // console.log(response.data.payload)
    const subject = response.data.payload.headers.find(
        (header) => header.name === 'Subject'
    ).value;
    const from = response.data.payload.headers.find(
        (header) => header.name === 'From'
    ).value;


    const replyTo = from.match(/<(.*)>/)[1];
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const replyBody = `Hey,\n\nI won't be able to reply at this moment.I will get back to you ASAP !!\n\nThank you`;

    const rawMessage = [
        `From: me`,
        `To: ${replyTo}`,
        `Subject: ${replySubject}`,
        `In-Reply-To: ${messId}`,
        `References: ${messId}`,
        '',
        replyBody,
    ].join('\n');

    const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // console.log(encodedMessage);
    await gmail.users.messages.send({
        userId: 'me',
        resource: {
            raw: encodedMessage,
            threadId: messId,
        }
    },(err,res)=>{
        if (err) {
            console.error('Error sending email:', err);
            return;
        }
          console.log(`Successfully replied to email ${replySubject}`);
    });
};

const addLabel = async (messId,labelId)=>{
    try {
        const response = await gmail.users.messages.modify({
            userId: 'me',
            id: messId,
            requestBody: {
                addLabelIds: [labelId],
                removeLabelIds: ['INBOX'],
            },
        });
        console.log(`Email ${messId} moved to label 'ToRead'`);
      } catch (error) {
        console.error('Error while moving email to label:', error);
      }
};


// Function to check if the 'ToRead' label exists and create it if not
const getLabelId = async (auth) => {

    // Use the authenticated credentials to access the Gmail API
    gmail = google.gmail({version: 'v1', auth});
    try {
      const labelsResponse = await gmail.users.labels.list({
        userId: 'me',
      });
  
      const labels = labelsResponse.data.labels;
  
      // Check if the 'ToRead' label already exists
      const toReadLabel = labels.find(label => label.name === 'ToRead');
  
      if (toReadLabel) {
        console.log("Label 'ToRead' already exists with ID:", toReadLabel.id);
        return toReadLabel.id;
      } else {
        // creating 'ToRead' label
        const createLabelResponse = await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name: 'ToRead',
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
          },
        });
  
        const createdLabel = createLabelResponse.data;
        console.log("Label 'ToRead' created with ID:", createdLabel.id);
        return createdLabel.id;
      }
    } catch (error) {
      console.error('Error while checking or creating label:', error);
      throw error;
    }
};
const runMain = async (labelId)=> {
    // console.log(auth);
    let mails = await getUnrepliedEmailsId();

    // Send reply to each email
    for(let i=0;i<mails.length;i++){
        await sendReply(mails[i].id);
        await addLabel(mails[i].id,labelId);
    }
};
app.get('/', async (req,res)=>{

    authorize()
        .then(async (auth)=>{

            const labelId = await getLabelId(auth);


            // Run runApp every 45 to 120 seconds
            const interval = [45000, 120000];
            setInterval(async() => {
                await runMain(labelId);
            }, Math.floor(Math.random() * (interval[1] - interval[0] + 1) + interval[0]));
            
        })
        .catch(console.error);

    res.send('Authentication successful! The Bot is started !!');
});

app.listen(PORT,()=>{

    console.log(`Server is running at http://localhost:${PORT}`);
});