require('dotenv').config();

const { exec } = require('child_process');
const cheerio = require('cheerio');
const fs = require('fs');
const archiver = require('archiver');
const path = require('path');

const mysql = require('mysql');
const mysqldump = require('mysqldump');
const replaceInFile = require('replace-in-file');

// Obtém a data atual e a converte para a string ISO, substitui os caracteres que não são permitidos em nomes de arquivo
const dateTime = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, '');
// Concatena a string de data e hora ISO com '.sql' para criar o nome do arquivo
const sqlFilePath = `dump_${dateTime}.sql`;

const getMysqlPort = () => {

    return new Promise((resolve, reject) => {
        exec('docker-compose ps', (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return;
            }

            // Encontra o serviço MySQL
            const lines = stdout.split('\n');
            const mysqlLine = lines.find(line => line.includes('mysql'));

            if (!mysqlLine) {
                console.error('MySQL service not found.');
                return;
            }

            // Divide a linha em colunas e encontra a porta
            const columns = mysqlLine.split(/\s+/);
            const portsColumn = columns.find(column => column.includes('->3306'));

            if (!portsColumn) {
                console.error('MySQL port not found.');
                return;
            }

            // A porta estará no formato "0.0.0.0:xxxx->3306/tcp", queremos extrair xxxx
            const port = portsColumn.split(':')[1].split('->')[0];
            resolve(port)
        });
    });
}

const getNginxPort = () => {
    return new Promise((resolve, reject) => {
        exec('docker-compose ps', (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return;
            }

            // Encontra o serviço Nginx
            const lines = stdout.split('\n');
            const nginxLine = lines.find(line => line.includes('nginx'));

            if (!nginxLine) {
                console.error('Nginx service not found.');
                return;
            }

            // Divide a linha em colunas e encontra a porta
            const columns = nginxLine.split(/\s+/);
            const portsColumn = columns.find(column => column.includes('->80'));

            if (!portsColumn) {
                console.error('Nginx port not found.');
                return;
            }

            // A porta estará no formato "0.0.0.0:xxxx->3306/tcp", queremos extrair xxxx
            const port = portsColumn.split(':')[1].split('->')[0];
            resolve(port)
        });
    });
}

const verifyAppFileExist = () => {
    return new Promise(async (resolve, reject) => {
        const zipFilePath = path.join(__dirname, 'app.zip');

        await new Promise((resolve, reject) => {
            fs.access(zipFilePath, fs.constants.F_OK, (err) => {
                if (!err) {
                    // O arquivo existe, então vamos removê-lo
                    fs.unlink(zipFilePath, (err) => {
                        if (err) {
                            console.error(`Error deleting file: ${err}`);
                        } else {
                            console.log('File deleted successfully');
                        }
                    });
                }

                resolve()


            });
        });

        resolve()


    });
}

const zipAppFolder = () => {
    return new Promise(async (resolve, reject) => {
        // Verifica se existe o arquivo app.zip. Se existir, exclui para gerar um novo
        await verifyAppFileExist()

        // Cria um arquivo de stream
        let output = fs.createWriteStream(__dirname + '/app.zip');

        // Inicializa o arquivador zip
        let archive = archiver('zip', {
            zlib: { level: 9 } // Define o nível de compactação
        });

        // Registra quaisquer avisos (por exemplo, tamanho da entrada > tamanho esperado)
        archive.on('warning', function (err) {
            if (err.code === 'ENOENT') {
                // Avisos de log
                console.log(err);
            } else {
                // Lança erro para outras situações
                throw err;
            }
        });

        // Registra erros
        archive.on('error', function (err) {
            throw err;
        });

        // Canaliza o arquivo de arquivamento para a saída
        archive.pipe(output);

        // Arquiva a pasta app, recursivamente (por isso o '**')
        archive.directory('app/', false);

        // Finaliza o arquivamento - necessário para o stream concluir
        archive.finalize().then(() => {
            console.log('Processo de backup finalizado')
        });
        resolve()
    });
}

const mountDbPayload = async () => {
    const mysqlPort = await getMysqlPort()
    return new Promise((resolve, reject) => {
        resolve({
            host: `localhost`,
            user: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
            port: mysqlPort
        })
    });
}

const testDatabaseConnection = () => {
    return new Promise(async (resolve, reject) => {
        const dbConfig = await mountDbPayload();
        const connection = mysql.createConnection(dbConfig);
        connection.connect(err => {
            if (err) {
                console.error(err)
                reject(false);
                return;
            }
            console.log('Successfully connected to the database.');
            connection.end();
            resolve(true);
        });
    });
}

const exportAndReplace = async () => {

    const nginxPort = await getNginxPort()
    const dbConfig = await mountDbPayload();

    const testConnection = await testDatabaseConnection()

    if (testConnection === false) {
        console.error('Erro ao conectar com o banco de dados')
        return
    }

    // Monta o nome do arquivo

    // Exporta o banco de dados para um arquivo .sql
    mysqldump({
        connection: dbConfig,
        dumpToFile: sqlFilePath,
    }).then(() => {

        // Substitui as strings no arquivo .sql
        const prodDomain = 'aescolagenesis.com.br'

        replaceInFile({
            files: sqlFilePath,
            from: [new RegExp(`localhost:${nginxPort}`, 'g'), new RegExp('localhost', 'g'), new RegExp('http://' + prodDomain, 'g')],
            to: [prodDomain, prodDomain, `https://${prodDomain}`],
        }).then(changes => {
            console.log('Modified files:', changes.join(', '));
        }).catch(error => {
            console.error('Error occurred:', error);
        });
    }).catch(err => {
        console.log(err);
    });
}

const init = async () => {
    await zipAppFolder()
    await exportAndReplace()
}

init();