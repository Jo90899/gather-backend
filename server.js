const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const uuid = require('uuid');
const https = require("https");
const fs = require("fs");
const nodemailer = require('nodemailer');
const multer = require('multer');
const csv = require('fast-csv');

const options = {
  key: fs.readFileSync("/etc/letsencrypt/live/gather-maps.com/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/gather-maps.com/fullchain.pem")
};

const app = express();
const upload = multer({ dest: 'uploads/' });

// Email configuration
const transporter = nodemailer.createTransport({
  host: 'smtp.your-email-provider.com', // Replace with your SMTP host
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

app.use(bodyParser.json());
app.use(cors({
  origin: ['https://localhost:3000', 'https://gather-maps.com'],
  credentials: true
}));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

let events = {};

// Health check route
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Updated create event endpoint with CSV handling
app.post('/components/create-event', upload.single('participantFile'), async (req, res) => {
  try {
    const eventData = JSON.parse(req.body.eventData);
    const eventId = uuid.v4();
    
    // Create event structure
    events[eventId] = {
      ...eventData,
      eventId,
      participants: [],
      invitedParticipants: [],
      invitationsSent: false
    };

    // Process CSV file if uploaded
    if (req.file) {
      const participants = await new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(req.file.path)
          .pipe(csv.parse({ headers: true }))
          .on('error', reject)
          .on('data', (row) => {
            if (row.name && row.email) {
              results.push({
                name: row.name.trim(),
                email: row.email.trim()
              });
            }
          })
          .on('end', () => {
            fs.unlinkSync(req.file.path);
            resolve(results);
          });
      });

      events[eventId].invitedParticipants = participants;
    }

    res.json({ 
      eventId,
      eventUrl: `${process.env.FRONTEND_URL}/my-event/${eventId}`
    });

  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// New invitation endpoint
app.post('/invite-participants/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = events[eventId];
    
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const eventUrl = `${process.env.FRONTEND_URL}/my-event/${eventId}`;
    const invitations = event.invitedParticipants;

    const sendPromises = invitations.map(async (participant) => {
      try {
        await transporter.sendMail({
          from: '"Gather Maps" <noreply@gather-maps.com>',
          to: participant.email,
          subject: `Invitation to ${event.eventTitle}`,
          html: `
            <h2>You're invited to ${event.eventTitle}</h2>
            <p>Hi ${participant.name},</p>
            <p>${event.mainUserName} has invited you to an event!</p>
            <p>Click below to view event details and RSVP:</p>
            <a href="${eventUrl}" style="
              display: inline-block;
              padding: 12px 24px;
              background-color: #4CAF50;
              color: white;
              text-decoration: none;
              border-radius: 4px;
              margin: 20px 0;
            ">View Event</a>
            <p><strong>Event Details:</strong></p>
            <p>${event.eventDescription}</p>
            <p>Location: ${event.eventAddress}</p>
          `
        });
        return { success: true, email: participant.email };
      } catch (error) {
        console.error(`Failed to send to ${participant.email}:`, error);
        return { success: false, email: participant.email };
      }
    });

    const results = await Promise.all(sendPromises);
    const successfulSends = results.filter(r => r.success).length;

    events[eventId].invitationsSent = true;

    res.json({
      success: true,
      totalInvitations: invitations.length,
      successfulSends,
      failedSends: invitations.length - successfulSends
    });

  } catch (error) {
    console.error('Error sending invitations:', error);
    res.status(500).json({ error: 'Failed to send invitations' });
  }
});

// Existing endpoints below
app.post('/join-event/:eventId', (req, res) => {
  const { eventId } = req.params;
  const { name, phone, address, hasCar, canGiveRides, maxPassengers } = req.body;

  if (!events[eventId]) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const existingParticipantIndex = events[eventId].participants.findIndex(p => p.phone === phone);

  if (existingParticipantIndex !== -1) {
    events[eventId].participants[existingParticipantIndex] = {
      name,
      phone,
      address,
      hasCar,
      canGiveRides,
      maxPassengers
    };
    return res.json({ success: true, updated: true });
  }

  events[eventId].participants.push({ 
    name, 
    phone, 
    address, 
    hasCar, 
    canGiveRides, 
    maxPassengers 
  });

  res.json({ success: true, updated: false });
});

app.get('/join-event/:eventId', (req, res) => {
  const { eventId } = req.params;
  if (!events[eventId]) {
    return res.status(404).send('Event not found');
  }
  res.sendFile(path.join(__dirname, '../../build/index.html'));
});

app.get('/event/:eventId', (req, res) => {
  const { eventId } = req.params;
  if (events[eventId]) {
    res.json(events[eventId]);
  } else {
    res.status(404).json({ error: 'Event not found' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server running on port ${port}`));

https.createServer(options, app).listen(5050);