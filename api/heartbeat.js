// Vercel Serverless Function — keeps Supabase free tier project alive
// Runs once daily via Vercel Cron to prevent the 7-day inactivity pause
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Verify the request is from Vercel Cron (not a random visitor)
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Simple lightweight query — just enough to count as activity
    const { count, error } = await supabase
      .from('designs')
      .select('id', { count: 'exact', head: true });

    if (error) {
      console.error('Heartbeat query failed:', error.message);
      return res.status(500).json({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`Heartbeat OK — ${count} designs in database`);
    return res.status(200).json({
      status: 'ok',
      designs: count,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Heartbeat exception:', err);
    return res.status(500).json({
      status: 'error',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
}
