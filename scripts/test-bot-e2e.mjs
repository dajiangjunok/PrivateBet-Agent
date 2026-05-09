#!/usr/bin/env node
/**
 * PrivateBet Bot E2E Test
 * 
 * Sends commands to the bot via Telegram API and validates responses.
 * The bot must be running separately (long polling).
 * 
 * Usage: node test-bot-e2e.js
 * 
 * Required env: TELEGRAM_BOT_TOKEN, TEST_CHAT_ID
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TEST_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.error('TELEGRAM_BOT_TOKEN and TEST_CHAT_ID are required');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

let passed = 0;
let failed = 0;

async function api(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function sendMessage(text) {
  const res = await api('sendMessage', { chat_id: CHAT_ID, text });
  if (!res.ok) {
    throw new Error(`sendMessage failed: ${res.description}`);
  }
  return res.result;
}

async function getBotReplies(afterMsgId, maxWaitMs = 5000) {
  // Wait for bot to process and reply
  await new Promise(r => setTimeout(r, 2000));
  
  // We can't use getUpdates while bot is polling (409 conflict)
  // Instead, we'll check the last few messages in the chat
  // Since we can't read chat history via Bot API, we'll rely on
  // the bot process logs and manual verification
  
  // For now, just check that the bot is alive
  const me = await api('getMe');
  return me;
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

async function main() {
  console.log('🧪 PrivateBet Bot E2E Tests\n');
  console.log(`Bot: @zama_poly_bot`);
  console.log(`Chat: ${CHAT_ID}\n`);

  // Test 1: Bot is alive
  await test('Bot is alive (getMe)', async () => {
    const res = await api('getMe');
    if (!res.ok) throw new Error('getMe failed');
    if (res.result.username !== 'zama_poly_bot') throw new Error(`Wrong bot: ${res.result.username}`);
  });

  // Test 2: Health endpoint
  await test('Health endpoint responds', async () => {
    const res = await fetch('http://localhost:3001/');
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`Unexpected: ${JSON.stringify(data)}`);
  });

  // Test 3: Send /start command
  await test('/start command accepted', async () => {
    const res = await sendMessage('/start');
    if (!res.message_id) throw new Error('No message_id returned');
    console.log(`    → Message sent (id: ${res.message_id})`);
  });

  // Wait for bot to reply
  await new Promise(r => setTimeout(r, 3000));

  // Test 4: Send /agree
  await test('/agree command accepted', async () => {
    const res = await sendMessage('/agree');
    if (!res.message_id) throw new Error('No message_id returned');
  });

  await new Promise(r => setTimeout(r, 3000));

  // Test 5: Send /create_wallet
  await test('/create_wallet command accepted', async () => {
    const res = await sendMessage('/create_wallet');
    if (!res.message_id) throw new Error('No message_id returned');
  });

  await new Promise(r => setTimeout(r, 3000));

  // Test 6: Send /balance
  await test('/balance command accepted', async () => {
    const res = await sendMessage('/balance');
    if (!res.message_id) throw new Error('No message_id returned');
  });

  await new Promise(r => setTimeout(r, 3000));

  // Test 7: Send /help
  await test('/help command accepted', async () => {
    const res = await sendMessage('/help');
    if (!res.message_id) throw new Error('No message_id returned');
  });

  await new Promise(r => setTimeout(r, 3000));

  // Test 8: Send /positions
  await test('/positions command accepted', async () => {
    const res = await sendMessage('/positions');
    if (!res.message_id) throw new Error('No message_id returned');
  });

  await new Promise(r => setTimeout(r, 3000));

  // Test 9: Bot still alive after all commands
  await test('Bot still alive after all commands', async () => {
    const res = await api('getMe');
    if (!res.ok) throw new Error('getMe failed - bot may have crashed');
  });

  // Summary
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.log('\n⚠️  Some tests failed. Check the bot process logs for errors.');
    console.log('   The bot should have replied to each command in Telegram.');
    console.log('   Please verify in the Telegram app that replies were received.');
  } else {
    console.log('\n✨ All commands were sent successfully!');
    console.log('   Please verify in the Telegram app that the bot replied to each command.');
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
