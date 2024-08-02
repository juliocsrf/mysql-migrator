# Use uma imagem base do Node.js
FROM node:20

# Instale o cliente MySQL para permitir o uso do mysqldump
RUN apt-get update && apt-get install -y default-mysql-client

# Defina o diretório de trabalho dentro do contêiner
WORKDIR /usr/src/app

# Copie o package.json e o package-lock.json para o diretório de trabalho
COPY package*.json ./

# Instale as dependências da aplicação
RUN npm install

# Copie o código da aplicação para o diretório de trabalho
COPY . .

# Verifica se a pasta "out" existe e cria se não existir
RUN mkdir -p out

# Comando para iniciar a aplicação quando o contêiner for iniciado
CMD ["node", "index.js"]
