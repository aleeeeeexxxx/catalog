/*
 * @author Alex
 */

import pino from 'pino';
import { basename } from 'path';

const defaultLogger = pino({
    transport: {
        level: process.env.LOG_LEVEL || 'info',
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        },
    },
});

export function getLogger(component: string): pino.Logger {
    component = basename(__filename);
    return defaultLogger.child({ component });
}
