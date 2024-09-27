/*
    * index.js
    * Entry point for the application.
    * Loads environment variables and starts the Discord bot.
*/

const { loadEnvVariables } = require('./env_config');
const { AudioBot } = require('./discord_bot');

(async () => {
    const envVariables = loadEnvVariables();
    console.log('Environment variables loaded - index.js: ');

    const bot = new AudioBot(
        envVariables.DISCORD_BOT_TOKEN,
        envVariables.SPEECH_KEY,
        envVariables.SPEECH_REGION,
        envVariables.SPOTIFY_CLIENT_ID,
        envVariables.SPOTIFY_CLIENT_SECRET,
        envVariables.YOUTUBE_API_KEY,
    );
    bot.run();
})();
