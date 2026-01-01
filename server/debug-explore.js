const cronParser = require('cron-parser');

console.log('Keys:', Object.keys(cronParser));

if (cronParser.CronExpressionParser) {
    console.log('CronExpressionParser found');
    try {
        const parser = new cronParser.CronExpressionParser();
        console.log('Parser instance created');
        console.log('Parser keys:', Object.keys(parser));
        // Try to parse
        if (parser.parse) {
            const interval = parser.parse('*/30 * * * * *');
            console.log('Parsed:', interval.next().toString());
        }
    } catch (e) {
        console.log('Error with CronExpressionParser:', e.message);
    }
}

// Try default export
if (cronParser.default) {
    console.log('Default export found');
    console.log('Default keys:', Object.keys(cronParser.default));
}
