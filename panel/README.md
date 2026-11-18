# Panel Kairos

Alta automática de negocios en el VPS: al crear uno (Eatsy o Stockify) el panel

1. crea su base aislada (esquema + usuario propio en PostgreSQL para Eatsy, base + usuario propio en MySQL para Stockify),
2. crea la app en Coolify con el subdominio `https://<negocio>.pckairos.cloud` (HTTPS automático),
3. carga sus variables y la despliega,
4. (Eatsy) la agrega a "Todas mis instalaciones" del superadmin.

También permite suspender, reactivar, redesplegar y eliminar cada negocio.

- URL: https://panel.pckairos.cloud
- Corre en Coolify (proyecto pckairos, app `panel`, base directory `/panel`, Nixpacks, puerto 3000).
- Variables de entorno: ver `lib/config.js` (todas se cargan en Coolify; ninguna va en el repo).
