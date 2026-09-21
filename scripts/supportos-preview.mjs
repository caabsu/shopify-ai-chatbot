import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(Object.entries(dotenv.parse(readFileSync('apps/admin/.vercel/.env.production.local'))).map(([k,v]) => [k,v.trim()]));
// Local-only session secret: production cookies cannot be created or used here.
env.JWT_SECRET = randomBytes(40).toString('hex');
env.NODE_ENV = 'development';
env.SUPPORTOS_NEXT_DIST_DIR = '.next-preview';
env.SUPPORT_AUTOMATION_SECRET = '';
env.SUPPORTOS_READ_ONLY_PREVIEW = '1'; // Middleware blocks mutations in this local preview.
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: brand, error } = await db.from('brands').select('id,name,slug').eq('slug','warm-by-design').single();
if (error || !brand) throw new Error('Could not load preview brand');
const token = await new SignJWT({ brandId: brand.id, brandName: brand.name, brandSlug: brand.slug, role: 'admin', name: 'Local preview' }).setProtectedHeader({alg:'HS256'}).setExpirationTime('4h').sign(new TextEncoder().encode(env.JWT_SECRET));
mkdirSync('output/supportos-upgrade', { recursive: true });
writeFileSync('output/supportos-upgrade/preview-auth.json', JSON.stringify({cookies:[{name:'admin_token',value:token,domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax',expires:Math.floor(Date.now()/1000)+14400}],origins:[]}));
console.log('Local preview starts on http://localhost:3002. Preview authentication saved (not printed).');
const server = spawn(process.execPath, ['../../node_modules/next/dist/bin/next','dev','-p','3002'], { cwd: 'apps/admin', env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
server.on('exit', code => process.exit(code || 0));
