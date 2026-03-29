import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vqlwebvgmunlrtdcmwhs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxbHdlYmdtdW5scnRkY213aHMiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc3NDc4NjM0NywiZXhwIjoyMDkwMzYyMzQ3fQ.bL3cwhCARe4dWUZzHClbsKsa20tDJh8mzRNLI-4ZcA8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
