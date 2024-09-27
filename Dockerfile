# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set the working directory
WORKDIR /usr/src/app

# Install necessary system dependencies (including FFmpeg)
RUN apt-get update && \
    apt-get install -y \
    wget \
    gnupg \
    libnss3-dev \
    libgdk-pixbuf2.0-dev \
    libgtk-3-dev \
    libxss-dev \
    libasound2 \
    libcurl4 \
    libu2f-udev \
    libvulkan1 \
    xdg-utils \
    ffmpeg \
    fonts-liberation \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json into the container
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --only=production

# Copy the rest of the application code into the container
COPY . .

# Copy .env file into the container
COPY .env /usr/src/app

# Expose the bot port (if necessary)
EXPOSE 3000

# Command to run the bot
CMD ["node", "index.js"]