FROM node:24.18.0-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    QRBD_DATA_DIR=/var/lib/qrbd
WORKDIR /app
RUN mkdir -p /var/lib/qrbd && chown node:node /app /var/lib/qrbd
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server.mjs admin.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node agent/windows_agent.py ./agent/windows_agent.py
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
