#!/usr/bin/env node
const fs=require('fs'); const crypto=require('crypto');
const [,,privateKeyPath,outputPath,plan='STANDARD',expiresAt=''] = process.argv;
if(!privateKeyPath||!outputPath){console.error('Usage: node scripts/generate-license.js <private-key.pem> <license.json> [plan] [expiresAt]');process.exit(2);}
const privateKey=crypto.createPrivateKey(fs.readFileSync(privateKeyPath));
const license={product:'HRPRO-JORDAN',plan,expiresAt:expiresAt||null,maxEmployees:null,companyId:null};
const body=JSON.stringify(license); const s=crypto.createSign('SHA256'); s.update(body); s.end(); license.signature=s.sign(privateKey).toString('base64');
fs.writeFileSync(outputPath,JSON.stringify(license,null,2)); console.log(`License written: ${outputPath}`);
