const cronParser = require('cron-parser');

try {
    console.log('Testing new CronExpression...');
    const interval = new cronParser.CronExpression('*/30 * * * * *');
    console.log('Success:', interval.next().toString());
} catch (e) {
    console.log('Error with new CronExpression:', e.message);
}

try {
    console.log('Testing parseExpression again...');
    const interval = cronParser.parseExpression('*/30 * * * * *');
    console.log('Success:', interval.next().toString());
} catch (e) {
    console.log('Error with parseExpression:', e.message);
}
