// Dockerfile de cada negocio de Stockify.
// Clona el repo, instala el backend y al arrancar corre scripts/bootstrap.js, que prepara el
// esquema PostgreSQL del negocio si está vacío:
//   - SEED_DEMO=1: datos de ejemplo (y la clave del superadmin = BOOT_SUPERADMIN_PASSWORD).
//   - si no:       solo la empresa, la casa central, el superadmin y el admin (BOOT_*).
import { config } from './config.js';

export function dockerfileStockify() {
  const repo = config.stockify.repo;
  return `FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
# Cambia con cada commit nuevo en main -> fuerza a bajar el codigo actualizado
ADD https://api.github.com/repos/${repo}/git/refs/heads/main /tmp/version.json
RUN git clone --depth 1 https://github.com/${repo} . && cd backend && npm ci --omit=dev
WORKDIR /app/backend
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "node scripts/bootstrap.js && node server.js"]
`;
}
