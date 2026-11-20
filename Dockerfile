# Use official Node.js LTS image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./


# Install compilation tools needed by better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ libsqlite3-dev && rm -rf /var/lib/apt/lists/*

# Install production dependencies
RUN npm ci --omit=dev


# Copy the rest of the application code
COPY . .

# Expose the port (the app will read process.env.PORT)
EXPOSE 3000

# Start the server
CMD ["npm","start"]
