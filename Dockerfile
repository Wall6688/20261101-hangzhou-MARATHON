FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "$NPM_REGISTRY" && npm install --omit=dev
COPY server.js ./
COPY public ./public
ENV NODE_ENV=production
EXPOSE 6000
CMD ["npm", "start"]
