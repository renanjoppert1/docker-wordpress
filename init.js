const axios = require('axios');
const fs = require('fs');
const unzipper = require('unzipper');

async function downloadAndExtractWordPress() {
    try {
        // Obter informações da versão mais recente do WordPress
        const response = await axios.get('https://wordpress.org/latest.zip', { responseType: 'arraybuffer' });

        // Salvar o arquivo zip do WordPress
        fs.writeFileSync('wordpress.zip', response.data);

        // Extrair o arquivo zip para a pasta "./app"
        await fs.createReadStream('wordpress.zip')
            .pipe(unzipper.Extract({ path: '.', strip: 1 }))
            .promise();

        // Remover o arquivo zip após a extração
        fs.unlinkSync('wordpress.zip');

        // Renomear a pasta "wordpress" para "app"
        fs.renameSync('wordpress', 'app');

        console.log('WordPress instalado com sucesso!');
    } catch (error) {
        console.error('Ocorreu um erro ao baixar e extrair o WordPress:', error);
    }
}

downloadAndExtractWordPress();
