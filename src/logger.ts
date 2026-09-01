/*
 * @author Alex
 */

import pino from 'pino';
import { basename } from 'path';

const defaultLogger = pino({
    level: process.env.LOG_LEVEL || 'debug',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            sync: true,
        },
    },
});

export function getLogger(component: string): pino.Logger {
    component = basename(component);
    return defaultLogger.child({ component });
}
