import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

serve(() => Response.json({ ok: true, service: 'onmaeul-edge' }))
