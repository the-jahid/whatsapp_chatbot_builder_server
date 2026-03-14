import { AuthenticationState, jidNormalizedUser } from '@whiskeysockets/baileys';

export const buildTcTokenFromJid = async (jid: string, authState: AuthenticationState): Promise<Buffer | undefined> => {
    const userJid = jidNormalizedUser(jid);
    const { [userJid]: tokenData } = await authState.keys.get('tctoken', [userJid]);
    return tokenData?.token;
};
