import { v7 as uuidv7 } from 'uuid';

export function Generate32UUID(): string {
    return uuidv7().replace(/-/g, '');
}
