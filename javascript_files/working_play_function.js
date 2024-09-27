async playCommand(interaction) {
    try {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply('You need to be in a voice channel to play music!');
            }
            return;
        }

        // Check if reply or deferReply is already called
        if (!interaction.deferred) {
            await interaction.deferReply();
        }

        console.log('Entering play command');
        const query = interaction.options.getString('song_url', true);

        // Stop recording if active
        if (this.isRecording) {
            await this.stopRecording();
        }

        // Proceed with playing the song
        const { track } = await this.player.play(voiceChannel, query, {
            nodeOptions: { metadata: interaction }
        });

        if (!interaction.replied) {
            await interaction.followUp(`**${track.cleanTitle}** enqueued!`);
        }

    } catch (e) {
        console.error(`Error playing music: ${e.message}`);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(`Something went wrong: ${e.message}`);
        }
    }
}