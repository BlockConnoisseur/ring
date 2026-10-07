FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3320 3321
CMD ["npm", "start"]
