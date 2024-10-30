const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const uuid = require('uuid');

const app = express();

app.use(bodyParser.json());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000'
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

app.post('/components/create-event', (req, res) => {
  console.log('Received create event request:', req.body);
  const { eventTitle, eventAddress, eventDescription, mainUserName, mainUserEmail, mainUserAddress } = req.body;
  const eventId = uuid.v4();
  events[eventId] = {
    eventTitle,
    eventAddress,
    eventDescription,
    creator: { name: mainUserName, email: mainUserEmail, address: mainUserAddress },
    participants: []
  };
  res.json({ eventId });
});

app.post('/join-event/:eventId', (req, res) => {
  console.log('Received join/update event request:', req.params, req.body);
  const { eventId } = req.params;
  const { name, email, address, hasCar, canGiveRides, maxPassengers } = req.body;

  if (!events[eventId]) {
    console.log('Event not found:', eventId);
    return res.status(404).json({ error: 'Event not found' });
  }

  const existingParticipantIndex = events[eventId].participants.findIndex(p => p.email === email);

  if (existingParticipantIndex !== -1) {
    // Update existing participant information
    events[eventId].participants[existingParticipantIndex] = {
      name,
      email,
      address,
      hasCar,
      canGiveRides,
      maxPassengers
    };
    console.log('Participant information updated:', email);
    return res.json({ success: true, updated: true });
  }

  // Add new participant
  events[eventId].participants.push({ name, email, address, hasCar, canGiveRides, maxPassengers });
  console.log('New participant added:', email);
  res.json({ success: true, updated: false });
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