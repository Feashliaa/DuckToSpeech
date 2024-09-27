/*
    * discord_bot.js
    * This file contains the implementation of the AudioBot class.
    * The AudioBot class is responsible for handling the Discord bot logic.
    * It connects to a Discord server, listens for commands, and performs actions based on the commands.
    * The bot can join a voice channel, leave a voice channel, and record audio from users in the voice channel.
    * It uses the Microsoft Cognitive Services Speech SDK to perform speech recognition on the recorded audio.
    * The bot also has a soundboard feature that plays audio clips based on recognized speech.
    * The bot can be configured with a Discord bot token, a Speech API key, and a Speech region.
    * The bot uses the discord.js library to interact with the Discord API and the @discordjs/voice library for voice connections.
    * The bot also uses the prism-media library for audio processing and the microsoft-cognitiveservices-speech-sdk library for speech recognition.
    * The bot is designed to be run as a standalone application and can be started by running the index.js file.
    

    Help: https://www.npmjs.com/package/discord-player-youtubei
    Help: https://www.npmjs.com/package/discord-player
    Help: https://github.com/Androz2091/discord-player/tree/434d1f2d833ba1812ceb16d7481d473460c18850
*/

const { Client, GatewayIntentBits, GuildMember, Intents } = require('discord.js');
const { Player, QueryType, useMainPlayer, useQueue, entersState } = require('discord-player');
const prism = require('prism-media');
const { createAudioPlayer, createAudioResource, StreamType,
    demuxProbe, joinVoiceChannel, NoSubscriberBehavior,
    AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection,
    EndBehaviorType } = require('@discordjs/voice');
const { spawn } = require('child_process');
const fs = require('fs');
const sdk = require("microsoft-cognitiveservices-speech-sdk");
const { soundBoard } = require('./soundboard');
const SpotifyWebApi = require('spotify-web-api-node');
const { YoutubeiExtractor } = require("discord-player-youtubei")



class AudioBot {

    constructor(token, speechKey, speechRegion, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, YOUTUBE_API_KEY) {
        this.token = token;
        this.speechKey = speechKey;
        this.speechRegion = speechRegion;
        this.spotifyApi = new SpotifyWebApi({
            clientId: SPOTIFY_CLIENT_ID,
            clientSecret: SPOTIFY_CLIENT_SECRET,
        });
        this.youtubeApiKey = YOUTUBE_API_KEY;

        // Create a new Discord client, with only the necessary intents enabled
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent, // Include MessageContent if you need to read message content
            ],
        });

        // Login and handle any potential errors
        this.client.login(token).catch((error) => {
            console.error('Failed to login to Discord:', error);
        });

        this.player = new Player(this.client);
        this.player.extractors.register(YoutubeiExtractor, {});

        this.queue = new Map(); // Map of queues for each guild

        this.isRecording = false;
        this.isPlaying = false;
        this.ffmpegProcess = null;
        this.outputStream = null;
        this.audioStreams = new Map(); // Map of audio streams for each user
        this.currentConnection = null;

        this.player.on('error', (queue, error) => {
            console.error(`Player error: ${error.message}`);
            queue.metadata.channel.send(`An error occurred: ${error.message}`);
        });

        this.player.on('playerError', (queue, error) => {
            console.error(`Player error: ${error.message}`);
            queue.metadata.channel.send(`A player error occurred: ${error.message}`);
        });

        console.log('Bot initialized and ready to handle commands.');
    }


    async joinCommand(interaction) {
        if (interaction.member.voice.channel) {
            const voiceChannel = interaction.member.voice.channel;

            this.currentConnection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            this.utilizeSoundBoard(null, true, null);
            await interaction.reply('Joined the voice channel.');
        } else {
            await interaction.reply('You need to join a voice channel first!');
        }
    }

    async recordCommand(interaction) {
        if (this.isRecording) {
            await interaction.reply('Already recording!');
            return;
        }

        if (this.isPlaying) {
            await interaction.reply('Cannot record while music is playing.');
            return;
        }

        if (this.currentConnection) {
            this.startRecording(this.currentConnection, interaction.channel);
            await interaction.reply('Started recording.');
        } else if (interaction.member.voice.channel) {
            const voiceChannel = interaction.member.voice.channel;

            this.currentConnection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            this.startRecording(this.currentConnection, interaction.channel);
            await interaction.reply('Joined the voice channel and started recording.');
        } else {
            await interaction.reply('I need to be in a voice channel to start recording!');
        }
    }

    async leaveCommand(interaction) {
        const connection = getVoiceConnection(interaction.guild.id);
        if (connection) {
            // Create audio player and play goodbye sound
            const player = createAudioPlayer();
            const resource = createAudioResource("../audio_files/goodbye.mp3");
            player.play(resource);
            connection.subscribe(player);

            // Handle player events
            player.on('idle', async () => {
                this.stopRecording();
                connection.destroy();

                const messages = await interaction.channel.messages.fetch();
                for (const message of messages.values()) {
                    if (message.author.id === this.client.user.id) {
                        await message.delete(); // Ensure this resolves
                    }
                }

                await interaction.reply('Left the voice channel and stopped recording.');
            });


            player.on('error', (error) => {
                console.error(`Error: ${error.message}`);
            });
        } else {
            await interaction.reply('I am not in a voice channel!');
        }
    }

    async testCommand(interaction) {
        await interaction.reply('Test command executed!');
    }

    async playCommand(interaction) {
        try {
            const voiceChannel = interaction.member.voice.channel;
            if (!voiceChannel) {
                await interaction.reply('You need to be in a voice channel to play music!');
                return;
            }

            await interaction.deferReply();
            console.log('Entering play command');
            const query = interaction.options.getString('song_url', true);

            console.log("This is the recording status: ", this.isRecording);
            console.log("This is the playing status: ", this.isPlaying);

            if (this.isRecording) {
                console.log('Stopping recording before playing music');
                await this.stopRecording();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Ensure we're connected to the voice channel
            if (!this.currentConnection || this.currentConnection.state.status === VoiceConnectionStatus.Disconnected) {
                console.log('Not in a voice channel. Attempting to join...');
                this.currentConnection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });


                this.utilizeSoundBoard(null, true, null);

            }

            console.log('Voice channel joined');

            const { track } = await this.player.play(voiceChannel, query, {
                nodeOptions: {
                    // nodeOptions are the options for guild node (aka your queue in simple word)
                    metadata: interaction // we can access this metadata object using queue.metadata later on
                }
            });

            this.isPlaying = true;
            await interaction.followUp(`**${track.cleanTitle}** enqueued!`);

        } catch (e) {
            console.error('Error playing music:', e);
            await interaction.followUp(`Something went wrong: ${e.message}`);
        }
    }

    async skipCommand(interaction) {
        const queue = useQueue(interaction.guild.id);
        const client = interaction.client;  // Use client directly from interaction

        if (!queue) return interaction.reply({ content: `${client.dev.error} | I am **not** in a voice channel`, ephemeral: true });
        if (!queue.currentTrack)
            return interaction.reply({ content: `${client.dev.error} | There is no track **currently** playing`, ephemeral: true });

        queue.node.skip();
        return interaction.reply({
            content: `⏩ | I have skipped to the next track`
        });
    }

    async stopCommand(interaction) {
        const queue = useQueue(interaction.guild.id);
        const client = interaction.client;  // Use client directly from interaction

        if (!queue) return interaction.reply({ content: `${client.dev.error} | I am **not** in a voice channel`, ephemeral: true });
        if (!queue.currentTrack)
            return interaction.reply({ content: `${client.dev.error} | There is no track **currently** playing`, ephemeral: true });

        queue.tracks.clear();
        queue.node.stop();
        return interaction.reply({
            content: `⏹ | I have stopped the music`
        });
    }

    async syncCommands() {
        const guild = this.client.guilds.cache.first();
        if (!guild) {
            console.error('No guild found!');
            return;
        }

        /*
        Type: 
        1 - SUB_COMMAND, 2 - SUB_COMMAND_GROUP, 
        3 - STRING, 4 - INTEGER, 5 - BOOLEAN, 
        6 - USER, 7 - CHANNEL, 8 - ROLE
        9 - MENTIONABLE, 10 - NUMBER, 11: - Decimals
        */

        // Define your commands
        const commands = [
            {
                name: 'join',
                description: 'Join the voice channel',
            },
            {
                name: 'leave',
                description: 'Leave the voice channel',
            },
            {
                name: 'record',
                description: 'Start recording audio',
            },
            {
                name: 'test_command',
                description: 'Test command',
            },
            {
                name: 'play',
                description: 'Play a song',
                options: [
                    {
                        name: 'song_url',
                        description: 'Name of the song to play',
                        type: 3,
                        required: true,
                    },
                ],
            },
            {
                name: 'skip',
                description: 'Skip the current song',
            },
            {
                name: 'stop',
                description: 'Stop the music',
            },
        ];

        try {
            console.log('Clearing commands...');

            const existingCommands = await guild.commands.fetch();
            if (existingCommands.size > 7) {
                await guild.commands.set([]); // Clear existing commands
                console.log('Commands cleared!');
            } else {
                console.log('Less than 7 commands, no need to clear.');
            }

            console.log('Attempting to register commands...');
            for (const command of commands) {
                const createdCommand = await guild.commands.create(command);
                console.log(`Registered command: ${createdCommand.name} with ID: ${createdCommand.id}`);
            }
        } catch (error) {
            console.error('Failed to sync commands:', error);
        }
    }

    async setupCommands() {
        // Command map with corresponding handler functions
        const commandHandlers = {
            join: this.joinCommand.bind(this),
            leave: this.leaveCommand.bind(this),
            record: this.recordCommand.bind(this),
            test_command: this.testCommand.bind(this),
            play: this.playCommand.bind(this),
            skip: this.skipCommand.bind(this),
            stop: this.stopCommand.bind(this),
        };

        // Listen for interactions
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isCommand()) return;

            const command = interaction.commandName;
            if (commandHandlers[command]) {
                try {
                    await commandHandlers[command](interaction);
                } catch (error) {
                    console.error(`Error executing command ${command}: ${error.message}`);
                    await interaction.reply('There was an error executing that command.');
                }
            } else {
                await interaction.reply('Unknown command.');
            }
        });
    }

    startRecording(connection, textChannel) {
        console.log('Starting recording');
        this.isRecording = true;
        this.audioStreams.clear();

        connection.receiver.speaking.on('start', (userId) => {
            if (this.audioStreams.has(userId)) {
                console.log(`Already recording ${userId}.`);
                return;
            }

            const user = this.client.users.cache.get(userId);
            if (!user) return;

            console.log(`Started listening to ${user.username}`);

            const outputFilename = `../audio_files/recording_${user.username}_${Date.now()}.wav`;
            const outputStream = fs.createWriteStream(outputFilename);

            const ffmpegProcess = spawn('ffmpeg', [
                '-loglevel', 'error',
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '2',
                '-i', 'pipe:0',
                '-acodec', 'pcm_s16le',
                '-f', 'wav',
                'pipe:1',
            ]);

            ffmpegProcess.stdout.pipe(outputStream);

            ffmpegProcess.stderr.on('data', (data) => {
                console.error(`FFmpeg stderr (${user.username}): ${data.toString()}`);
            });

            ffmpegProcess.on('close', (code) => {
                console.log(`FFmpeg process for ${user.username} closed with code ${code}`);
                this.cleanupRecording(userId, outputFilename, textChannel);
            });

            ffmpegProcess.on('error', (error) => {
                console.error(`Error with FFmpeg process for ${user.username}: ${error}`);
                this.cleanupRecording(userId, outputFilename, textChannel);
            });

            const audioStream = connection.receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 100
                },
            });

            const opusDecoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
            audioStream.pipe(opusDecoder).on('data', (pcmData) => {
                if (!ffmpegProcess.stdin.destroyed) {
                    const canWrite = ffmpegProcess.stdin.write(pcmData);
                    if (!canWrite) {
                        audioStream.pause();
                        ffmpegProcess.stdin.once('drain', () => {
                            audioStream.resume();
                        });
                    }
                }
            });

            this.audioStreams.set(userId, { ffmpegProcess, audioStream, outputFilename });
        });

        connection.receiver.speaking.on('end', (userId) => {
            const audioStreamData = this.audioStreams.get(userId);
            if (audioStreamData) {
                this.cleanupRecording(userId, audioStreamData.outputFilename, textChannel);
            }
        });
    }

    async stopRecording() {
        console.log('Stopping all recordings...');
        console.log('isRecording:', this.isRecording, 'audioStreams size:', this.audioStreams.size);

        const stopPromises = Array.from(this.audioStreams.entries()).map(([userId, { ffmpegProcess, audioStream, outputFilename }]) => {

            console.log("Calling stopPromises: ", stopPromises);

            return new Promise((resolve) => {
                console.log(`Stopping recording for user: ${userId}`);
                audioStream.destroy();

                if (ffmpegProcess && ffmpegProcess.stdin) {
                    ffmpegProcess.stdin.end();
                }

                ffmpegProcess.on('close', () => {
                    console.log(`FFmpeg process for ${userId} closed.`);
                    this.cleanupRecording(userId, outputFilename);
                    resolve();
                });

                // Forcefully kill FFmpeg if it doesn't stop within a time limit
                setTimeout(() => {
                    if (ffmpegProcess && !ffmpegProcess.killed) {
                        console.log(`Forcefully killing FFmpeg for ${userId}`);
                        ffmpegProcess.kill('SIGINT');
                    }
                }, 3000);  // 3-second timeout to force stop FFmpeg if it's still running
            });
        });


        console.log('Waiting for all recordings to stop...');
        console.log("Calling stopPromises: ", stopPromises);

        await Promise.all(stopPromises);

        this.audioStreams.clear();
        this.isRecording = false;

        // Remove listeners to fully stop listening
        if (this.currentConnection) {
            console.log('Removing speaking listeners.');
            this.currentConnection.receiver.speaking.removeAllListeners('start');
            this.currentConnection.receiver.speaking.removeAllListeners('end');
        }

        console.log('All recordings stopped.');
    }



    cleanupRecording(userId, outputFilename, textChannel) {
        console.log(`Cleaning up recording for user: ${userId}`);
        console.log(`Output File: ${outputFilename}`);

        if (this.audioStreams.has(userId)) {
            const { ffmpegProcess, audioStream } = this.audioStreams.get(userId);
            audioStream.destroy();
            if (ffmpegProcess && ffmpegProcess.stdin) {
                ffmpegProcess.stdin.end();
            }
            this.audioStreams.delete(userId);

            console.log(`Stopped listening to user: ${userId}`);

            if (outputFilename && textChannel) {
                fs.access(outputFilename, fs.constants.F_OK, (err) => {
                    if (err) {
                        console.error(`Error accessing file: ${err.message}`);
                        textChannel.send(`Recording for user ${userId} failed!`);
                    } else {
                        console.log(`File ${outputFilename} is accessible. Proceeding with recognition.`);
                        setTimeout(() => this.recognizeFromFile(outputFilename), 1000);
                    }
                });
            } else {
                console.log(`Unable to process file. OutputFilename: ${outputFilename}, TextChannel: ${!!textChannel}`);
            }
        } else {
            console.log(`No audio stream found for user: ${userId}`);
        }

        if (this.audioStreams.size === 0) {
            this.isRecording = false;
            console.log('All recordings cleaned up. Setting isRecording to false.');
        }
    }

    // Recognize speech function with a proper request management queue
    // Free tier only allows 20 requests per minute
    recognizeFromFile(recordedFilePath) {
        console.log(`Recognizing speech from file: ${recordedFilePath}`);

        // Read the WAV file into a buffer
        fs.readFile(recordedFilePath, (err, fileData) => {
            if (err) {
                console.error(`Error reading file: ${err.message}`);
                return;
            }

            console.log(`Speech Key: ${this.speechKey}, Speech Region: ${this.speechRegion}`);

            // Create speech configuration
            const speechConfig = sdk.SpeechConfig.fromSubscription(this.speechKey, this.speechRegion);
            speechConfig.speechRecognitionLanguage = "en-US";
            speechConfig.setProfanity(sdk.ProfanityOption.Raw);

            // Create audio configuration from the file buffer
            const audioConfig = sdk.AudioConfig.fromWavFileInput(fileData);
            const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

            // Ensure no parallel requests are made
            if (!this.isProcessing) {
                this.isProcessing = true; // Set flag to true to prevent further requests

                recognizer.recognizeOnceAsync(result => {
                    this.isProcessing = false; // Reset flag after processing

                    if (result.reason === sdk.ResultReason.RecognizedSpeech) {
                        console.log(`Recognized: ${result.text}`);
                        this.utilizeSoundBoard(result.text);

                        // reason 0 = undefined
                        // reason 1 = recognized speech
                        // reason 2 = no match
                        // reason 3 = initial silence timeout
                        // reason 4 = babble timeout
                        // reason 5 = error
                        // reason 6 = end of file

                        // Clean up the recording file
                        fs.unlink(recordedFilePath, (err) => {
                            if (err) {
                                console.error(`Error deleting file: ${err.message}`);
                            } else {
                                console.log(`Deleted file: ${recordedFilePath}`);
                            }
                        });

                    }
                    // if result.errorDetails contains 'undefined' or 'NoMatch'
                    else if (result.reason === sdk.ResultReason.NoMatch) {
                        console.log('No speech could be recognized.');
                        // Clean up the recording file
                        fs.unlink(recordedFilePath, (err) => {
                            if (err) {
                                console.error(`Error deleting file: ${err.message}`);
                            } else {
                                console.log(`Deleted file: ${recordedFilePath}`);
                            }
                        });
                    }
                    else {
                        console.error(`Speech recognition failed: ${result.errorDetails}`);
                        if (result.errorDetails.includes('Quota exceeded')) {
                            setTimeout(() => {
                                console.log('Retrying recognition due to quota limits.');
                                recognizer.recognizeOnceAsync(retryResult => {
                                    this.isProcessing = false; // Reset flag after processing

                                    if (retryResult.reason === sdk.ResultReason.RecognizedSpeech) {
                                        console.log(`Recognized: ${retryResult.text}`);
                                        this.utilizeSoundBoard(retryResult.text);
                                    } else {
                                        console.error(`Speech recognition failed again: ${retryResult.errorDetails}`);
                                    }

                                    // Clean up the recording file
                                    fs.unlink(recordedFilePath, (err) => {
                                        if (err) {
                                            console.error(`Error deleting file: ${err.message}`);
                                        } else {
                                            console.log(`Deleted file: ${recordedFilePath}`);
                                        }
                                    });
                                });
                            }, 5000);  // Retry after 5 seconds
                        }
                    }
                });
            } else {
                console.log('Speech recognition is already in progress. Please wait.');
            }
        });
    }


    playSoundForAction(action) {
        const soundFiles = {
            "join": "../audio_files/newt.mp3",
            "leave": "../audio_files/goodbye.mp3"
        };
        this.playSound(soundFiles[action]);
    }

    cleanText(text) {
        return text.toLowerCase().replace(/[^a-zA-Z ]/g, "");
    }

    utilizeSoundBoard(recognized_text = null, joinVoiceChannel = null, leaveVoiceChannel = null) {
        if (joinVoiceChannel) {
            console.log("Joining voice channel");
            this.playSoundForAction("join");
            return;
        }

        if (leaveVoiceChannel) {
            console.log("Leaving voice channel");
            this.playSoundForAction("leave");
            return;
        }

        if (!recognized_text) {
            console.log("No recognized text");
            return;
        }

        console.log(`Utilizing soundboard for text: ${recognized_text}`);

        // Check if the word is a number, or if the sentence contains the number 50
        const number = parseInt(recognized_text);
        if (!isNaN(number) && number === 50 || recognized_text.includes("fifty") || recognized_text.includes("50")) {
            this.playSound("../audio_files/fifty.wav");
            return;
        }

        recognized_text = this.cleanText(recognized_text);

        for (const [word, soundFile] of Object.entries(soundBoard)) {
            if (recognized_text.includes(word)) {
                console.log(`Playing sound: ${soundFile}`);
                this.playSound(soundFile);
                break;
            }
        }
    }

    playSound(soundFile) {
        const player = createAudioPlayer();
        const resource = createAudioResource(soundFile);
        const connection = getVoiceConnection(this.client.guilds.cache.first().id);

        if (connection) {
            const subscription = connection.subscribe(player);
            player.play(resource);
        }
    }

    async run() {
        // Wait for the client to be ready before proceeding
        this.client.once('ready', async () => {
            console.log('Bot is ready!');

            // Synchronize commands once the bot is ready
            await this.syncCommands();
            console.log('Commands synchronized!');
        });

        // Setup command handlers
        this.setupCommands();

        // Log in the bot
        await this.client.login(this.token);
    }

}

module.exports = { AudioBot };
