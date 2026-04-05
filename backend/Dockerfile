# Optional: deploy backend from Railway UI (GitHub mirror) or docker build.
# Railway sets PORT; app reads process.env.PORT.

FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "src/index.js"]
