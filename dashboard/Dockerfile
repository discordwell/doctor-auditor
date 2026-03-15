FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
COPY desktop/package.json desktop/package.json
COPY dashboard/package.json dashboard/package.json
COPY shared/package.json shared/package.json
RUN npm ci --workspace=@doctor-auditor/dashboard --workspace=@doctor-auditor/shared --include-workspace-root=false
COPY dashboard ./dashboard
COPY shared ./shared
RUN npm run build --workspace=dashboard

FROM nginx:alpine
COPY --from=build /app/dashboard/dist /usr/share/nginx/html
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
