async joinCommand(interaction) {
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
        await interaction.reply('You need to join a voice channel first!');
        return;
    }

    // Check if already connected to the same voice channel
    if (this.currentConnection && this.currentConnection.joinConfig.channelId === voiceChannel.id) {
        await interaction.reply('Already connected to this voice channel!');
        return;
    }

    // If connected to a different channel, disconnect
    if (this.currentConnection) {
        this.currentConnection.destroy();
    }

    // Join the voice channel
    this.currentConnection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    console.log('Joined voice channel:', voiceChannel.name);

    this.utilizeSoundBoard(null, true, null);
    await interaction.reply('Joined the voice channel.');
}