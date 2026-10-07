import twilio from "twilio";
async function main() {
  const {
    TWILIO_ACCOUNT_SID: sid,
    TWILIO_AUTH_TOKEN: token,
    RING_PHONE_NUMBER: number,
    VOICE_PUBLIC_URL: base,
  } = process.env;
  if (!sid || !token || !number || !base?.startsWith("https://"))
    throw new Error(
      "Configure Twilio credentials, RING_PHONE_NUMBER and HTTPS VOICE_PUBLIC_URL first.",
    );
  const client = twilio(sid, token);
  const [phone] = await client.incomingPhoneNumbers.list({
    phoneNumber: number,
    limit: 1,
  });
  if (!phone?.capabilities.voice)
    throw new Error(
      "The configured number is not a voice-capable number owned by this Twilio account.",
    );
  if (!process.argv.includes("--apply")) {
    console.log(
      JSON.stringify(
        {
          phone: number,
          incoming: `${base}/incoming`,
          status: `${base}/status`,
          method: "POST",
        },
        null,
        2,
      ),
    );
    console.log(
      "Run npm run phone:configure -- --apply to configure this existing number. This command never buys a number.",
    );
    return;
  }
  await client
    .incomingPhoneNumbers(phone.sid)
    .update({
      voiceUrl: `${base.replace(/\/$/, "")}/incoming`,
      voiceMethod: "POST",
      statusCallback: `${base.replace(/\/$/, "")}/status`,
      statusCallbackMethod: "POST",
    });
  console.log(`Configured the Ring hotline on ${number}.`);
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
