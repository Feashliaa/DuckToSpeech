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

const { Client, GatewayIntentBits, GuildMember, Intents, Guild } = require('discord.js');
const prism = require('prism-media');
const { createAudioPlayer, createAudioResource, StreamType,
    demuxProbe, joinVoiceChannel, NoSubscriberBehavior,
    AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection,
    EndBehaviorType,
    getVoiceConnections } = require('@discordjs/voice');
const { spawn } = require('child_process');
const fs = require('fs');
const sdk = require("microsoft-cognitiveservices-speech-sdk");
const { soundBoard } = require('./soundboard');



class AudioBot {

    constructor(token, speechKey, speechRegion) {
        this.token = token;
        this.speechKey = speechKey;
        this.speechRegion = speechRegion;
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

        this.isRecording = false;
        this.audioStreams = new Map(); // Map of audio streams for each user
        this.currentConnection = null;

        console.log('Bot initialized and ready to handle commands.');
        this.voiceChannel = null;
    }

    async ensureConnection(interaction) {
        try {
            this.voiceChannel = interaction.member.voice.channel;

            if (!this.voiceChannel) {
                await interaction.followUp('You need to join a voice channel first!');
                return false;
            }

            // If connected to a different channel, disconnect
            if (this.currentConnection && this.currentConnection.joinConfig.channelId !== this.voiceChannel.id) {
                this.currentConnection.destroy();
                this.currentConnection = null;
            }

            // Join the voice channel if not connected
            if (!this.currentConnection) {
                this.currentConnection = joinVoiceChannel({
                    channelId: this.voiceChannel.id,
                    guildId: this.voiceChannel.guild.id,
                    adapterCreator: this.voiceChannel.guild.voiceAdapterCreator,
                });
                console.log('Joined voice channel:', this.voiceChannel.name);
            }

            return true;
        } catch (error) {
            console.error(`Error ensuring connection: ${error.message}`);
            await interaction.followUp('There was an error connecting to the voice channel.');
            return false;
        }
    }

    async joinCommand(interaction) {
        if (!await this.ensureConnection(interaction)) return;

        // Play a sound after joining the voice channel
        const player = createAudioPlayer();
        const resource = createAudioResource("../audio_files/newt.mp3");
        player.play(resource);
        this.currentConnection.subscribe(player);

        player.on('idle', async () => {
            await interaction.followUp('Joined the voice channel and played a sound.');
            player.stop();
            console.log('Player stopped after playing sound.');
        });

        player.on('error', (error) => {
            console.error(`Error: ${error.message}`);
        });

        await interaction.reply('Joined the voice channel.');
    }

    async recordCommand(interaction) {
        if (this.isRecording) {
            await interaction.reply('Already recording!');
            return;
        }
        if (this.currentConnection) {
            this.startRecording(this.currentConnection, interaction.channel);
            await interaction.reply('Started recording.');
        } else if (interaction.member.voice.channel) {
            this.voiceChannel = interaction.member.voice.channel;

            this.currentConnection = joinVoiceChannel({
                channelId: this.voiceChannel.id,
                guildId: this.voiceChannel.guild.id,
                adapterCreator: this.voiceChannel.guild.voiceAdapterCreator,
            });

            this.startRecording(this.currentConnection, interaction.channel);
            await interaction.reply('Joined the voice channel and started recording.');
        } else {
            await interaction.reply('I need to be in a voice channel to start recording!');
        }
    }

    async leaveCommand(interaction) {
        // Respond to the interaction immediately
        await interaction.reply('Leaving the voice channel...');

        // Check if the bot is already in the voice channel
        if (!this.currentConnection) {
            console.log('Connection not found in the bot instance.: ', this.currentConnection);
            console.log('I am not in a voice channel!');
            return;
        }

        console.log('I am in a voice channel!');

        // Create audio player and play goodbye sound
        const player = createAudioPlayer();
        const resource = createAudioResource("../audio_files/goodbye.mp3");
        player.play(resource);
        this.currentConnection.subscribe(player);

        // Handle player events
        player.on('idle', async () => {
            this.stopRecording();
            this.currentConnection.destroy();
            this.currentConnection = null;  // Reset connection

            // Try to delete bot messages
            try {
                const messages = await interaction.channel.messages.fetch();
                for (const message of messages.values()) {
                    if (message.author.id === this.client.user.id) {
                        await message.delete();  // Ensure message deletion resolves
                    }
                }
            } catch (error) {
                console.error(`Error deleting messages: ${error.message}`);
            }

            // Send follow-up message
            await interaction.followUp('Left the voice channel, and deleted messages.');
        });

        player.on('error', (error) => {
            console.error(`Error: ${error.message}`);
        });
    }

    async stopRecordingCommand(interaction) {
        console.log('Stopping recording before playing music');
        await this.stopRecording();
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!interaction.replied) {
            await interaction.reply('Stopped recording.');
        }
        this.isRecording = false;
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
                name: 'stop_recording',
                description: 'Stop recording audio',
            }
        ];

        try {
            console.log('Clearing commands...');

            const existingCommands = await guild.commands.fetch();
            if (existingCommands.size > 4) {
                await guild.commands.set([]); // Clear existing commands
                console.log('Commands cleared!');
            } else {
                console.log('Less than 4 commands, no need to clear.');
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
            stop_recording: this.stopRecordingCommand.bind(this),
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

            // Recognize speech from the audio file
            recognizer.recognizeOnceAsync((result) => {
                if (result.reason === sdk.ResultReason.RecognizedSpeech) {
                    console.log(`Recognized: ${result.text}`);
                    this.utilizeSoundBoard(result.text);
                } else if (result.reason === sdk.ResultReason.Canceled) {
                    const cancellationDetails = sdk.CancellationDetails.fromResult(result);
                    console.error(`CancellationReason: ${cancellationDetails.reason}`);
                    console.error(`ErrorDetails: ${cancellationDetails.errorDetails}`);
                    console.error(`Did you update the subscription info?`);
                } else {
                    console.error(`Error recognizing speech: ${sdk.ResultReason[result.reason]}`);
                }
                // delete the file if recognition failed
                fs.unlink(recordedFilePath, (err) => {
                    if (err) {
                        console.error(`Error deleting file: ${err.message}`);
                    }
                });
                recognizer.close();
            });


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
