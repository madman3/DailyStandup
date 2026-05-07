# Backend Docker image — deployed to Fly.io via fly deploy.
# PORT is set in fly.toml [env]; app reads process.env.PORT ?? 3001.

FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "src/index.js"]
