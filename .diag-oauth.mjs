import 'dotenv/config';

const clientId = process.env.SERVICENOW_CLIENT_ID;
const clientSecret = process.env.SERVICENOW_CLIENT_SECRET;
const username = process.env.SERVICENOW_USERNAME;
const password = process.env.SERVICENOW_PASSWORD;
const tokenUrl = process.env.SERVICENOW_TOKEN_URL;

console.log('tokenUrl:', tokenUrl);
console.log('clientId length:', clientId?.length, 'starts/ends with quote?', clientId?.[0], clientId?.at(-1));
console.log('clientSecret length:', clientSecret?.length, 'first/last char code:', clientSecret?.charCodeAt(0), clientSecret?.charCodeAt(clientSecret.length - 1));
console.log('username:', JSON.stringify(username));
console.log('password length:', password?.length, 'first/last char code:', password?.charCodeAt(0), password?.charCodeAt(password.length - 1));

const body = new URLSearchParams({
  grant_type: 'password',
  client_id: clientId,
  client_secret: clientSecret,
  username,
  password
});

const res = await fetch(tokenUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body
});

console.log('status:', res.status);
const text = await res.text();
console.log('body:', text);
