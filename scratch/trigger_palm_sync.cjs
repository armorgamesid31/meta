const axios = require('axios');

async function triggerSync() {
  const salonId = 7; // Palm Beauty verified salonId from previous logs
  console.log(`Triggering sync for Salon ID: ${salonId}`);
  
  try {
    const response = await axios.post(`http://localhost:3000/chakra/templates/sync`, {
      salonId: salonId
    });
    
    console.log('SYNC RESPONSE:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('SYNC FAILED:', error.response?.data || error.message);
  }
}

triggerSync();
