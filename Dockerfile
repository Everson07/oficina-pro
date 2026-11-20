# Use official Node.js LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if exists)
COPY package.json ./
COPY package-lock.json ./ || true

# Install dependencies (none required beyond Node built‑ins, but run npm ci for future packages)
RUN npm ci --only=production || npm install --production

# Copy the rest of the application code
COPY . .

# Expose the port (the app will read process.env.PORT)
EXPOSE 3000

# Start the server
CMD ["npm","start"]
