import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) throw new Error("No supabase URL or Api key found!")

export default createClient(supabaseUrl, supabaseKey)