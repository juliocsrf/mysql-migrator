const fs = require('fs');
const { exec } = require('child_process');
const mariadb = require('mariadb');
const dotenv = require('dotenv');

dotenv.config();

// Conexão com o banco de origem
const poolOrigem = mariadb.createPool({
    host: process.env.DB_HOST_SOURCE,
    port: process.env.DB_PORT_SOURCE,
    user: process.env.DB_USER_SOURCE,
    password: process.env.DB_PASSWORD_SOURCE,
    database: process.env.DB_DATABASE_SOURCE
});

console.log(`Using connection string for source: ${process.env.DB_USER_SOURCE}:${process.env.DB_PASSWORD_SOURCE}@${process.env.DB_HOST_SOURCE}:${process.env.DB_PORT_SOURCE}/${process.env.DB_DATABASE_SOURCE}`);
console.log(`Using connection string for target: ${process.env.DB_USER_TARGET}:${process.env.DB_PASSWORD_TARGET}@${process.env.DB_HOST_TARGET}:${process.env.DB_PORT_TARGET}/${process.env.DB_DATABASE_TARGET}`);

// Conexão com o banco de destino
const poolDestino = mariadb.createPool({
    host: process.env.DB_HOST_TARGET,
    port: process.env.DB_PORT_TARGET,
    user: process.env.DB_USER_TARGET,
    password: process.env.DB_PASSWORD_TARGET,
    database: process.env.DB_DATABASE_TARGET
});

async function pingDatabase(pool) {
    try {
        const connection = await pool.getConnection();
        connection.release();
        return true;
    } catch (error) {
        console.error(`Error connecting to database: ${error.message}`);
        return false;
    }
}

// Função para executar o dump do banco de origem
async function dumpDatabase(tableList, dumpFileName, includeData) {
    return new Promise((resolve, reject) => {
        const lockTablesOption = includeData ? '--complete-insert' : '--no-data';
        const tables = tableList.join(' ');
        const dumpCommand = `mysqldump --host=${process.env.DB_HOST_SOURCE} --user=${process.env.DB_USER_SOURCE} --password='${process.env.DB_PASSWORD_SOURCE}' ${process.env.DB_DATABASE_SOURCE} ${lockTablesOption} --skip-lock-tables ${tables} >> out/${dumpFileName}`;
        exec(dumpCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing dump command: ${error.message}`);
                reject(error);
            }
            console.log(`Dump of ${tableList.join(', ')} completed successfully.`);
            resolve();
        });
    });
}

// Função para executar o arquivo SQL no banco de destino
async function migrateDatabase(sqlFileName) {
    return new Promise((resolve, reject) => {
        const migrateCommand = `mysql --host=${process.env.DB_HOST_TARGET} --user=${process.env.DB_USER_TARGET} --password=${process.env.DB_PASSWORD_TARGET} ${process.env.DB_DATABASE_TARGET} < out/${sqlFileName}`;
        exec(migrateCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing migration command: ${error.message}`);
                reject(error);
            }
            console.log(`Migration from ${sqlFileName} completed successfully.`);
            resolve();
        });
    });
}

// Função para obter a lista de todas as tabelas no banco de dados
async function getAllTables() {
    const connection = await poolOrigem.getConnection();
    const tables = await connection.query('SHOW TABLES');
    connection.release();
    return tables.map(table => table[`Tables_in_${process.env.DB_DATABASE_SOURCE}`]);
}

// Função principal
async function main() {
    try {
        // Obter a lista de todas as tabelas no banco de dados
        const allTables = await getAllTables();

        // Ler o arquivo tables.json para obter as tabelas que contêm somente a estrutura
        const tables = JSON.parse(fs.readFileSync('tables.json', 'utf8'));

        // Fazer dump das tabelas que não estão na lista de apenas estrutura
        const tablesToDump = allTables.filter(table => !tables.structure_only.includes(table));
        console.log('Dumping full tables...');
        await dumpDatabase(tablesToDump, 'full.sql', true);

        if (tables.structure_only.length > 0) {
            // Fazer dump das estruturas das tabelas listadas em structure_only
            console.log('Dumping structure tables...');
            await dumpDatabase(tables.structure_only, 'structure.sql', false);
        }

        // Se ENABLE_MIGRATE estiver definido como TRUE, executar a migração
        if (process.env.ENABLE_MIGRATE === 'TRUE') {
            await migrateDatabase('full.sql');

            if (tables.structure_only.length > 0) {
                await migrateDatabase('structure.sql');
            }
        }

        console.log('Migration completed successfully.');
    } catch (error) {
        console.error(`Error during migration: ${error.message}`);
    } finally {
        // Fechar as conexões
        if (poolOrigem) await poolOrigem.end();
        if (poolDestino) await poolDestino.end();
    }
}


async function start() {
    console.log("Attempting to connect to origin database...");
    const sourcePing = await pingDatabase(poolOrigem);

    console.log("Attempting to connect to target database...");
    const targetPing = await pingDatabase(poolDestino);

    if (sourcePing && targetPing) {
        main();
    } else {
        process.exit(1);
    }
}

start();
