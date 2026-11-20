# Use official Node.js LTS image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if exists)
COPY package.json ./


# Install dependencies (none required beyond Node built‑ins, but run npm ci for future packages)
RUN apt-get update && apt-get install -y python3 make g++ libsqlite3-dev && rm -rf /var/lib/apt/lists/*


# Copy the rest of the application code
COPY . .

# Expose the port (the app will read process.env.PORT)
EXPOSE 3000

# Start the server
CMD ["npm","start"]
