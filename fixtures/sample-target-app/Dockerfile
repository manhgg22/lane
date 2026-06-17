FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src/ ./src/

ENV PORT=3000
ENV DATABASE_URL=./data/app.db

EXPOSE ${PORT}

HEALTHCHECK --interval=10s --timeout=3s \
  CMD node -e "const h=require('http');h.get('http://localhost:'+process.env.PORT+'/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]
