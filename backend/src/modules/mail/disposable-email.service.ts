import { Injectable } from '@nestjs/common';

const DISPOSABLE_DOMAINS: ReadonlyArray<string> = [
  '0815.ru',
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonbox.net',
  'anonymbox.com',
  'binkmail.com',
  'bobmail.info',
  'bsnow.net',
  'bugmenot.com',
  'deadaddress.com',
  'discard.email',
  'discardmail.com',
  'disposable.com',
  'disposable.email',
  'disposablemail.com',
  'dropmail.me',
  'emailondeck.com',
  'emailtemp.org',
  'fakeinbox.com',
  'fakemail.fr',
  'fakemail.net',
  'getairmail.com',
  'getnada.com',
  'getonemail.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamail.biz',
  'guerrillamailblock.com',
  'harakirimail.com',
  'incognitomail.com',
  'instantmail.com',
  'jetable.org',
  'mailcatch.com',
  'maildrop.cc',
  'mailexpire.com',
  'mailforspam.com',
  'mailinator.com',
  'mailinator.net',
  'mailinator.org',
  'mailmoat.com',
  'mailnesia.com',
  'mailnull.com',
  'meltmail.com',
  'mintemail.com',
  'mohmal.com',
  'monumentmail.com',
  'mt2015.com',
  'no-spam.ws',
  'nowmymail.com',
  'objectmail.com',
  'pookmail.com',
  'rcpt.at',
  'rmqkr.net',
  'sharklasers.com',
  'spam4.me',
  'spambog.com',
  'spambox.us',
  'spamfree24.org',
  'spamgourmet.com',
  'spamspot.com',
  'tempemail.com',
  'tempemail.net',
  'tempemail.org',
  'tempinbox.com',
  'tempmail.com',
  'tempmail.de',
  'tempmail.net',
  'tempmail.io',
  'tempmail.us',
  'tempr.email',
  'temp-mail.org',
  'temp-mail.ru',
  'tempymail.com',
  'throwaway.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'trashmail.net',
  'trbvm.com',
  'wegwerfemail.de',
  'wegwerfmail.de',
  'wegwerfmail.net',
  'wegwerfmail.org',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'zetmail.com',
];

@Injectable()
export class DisposableEmailService {
  private readonly set: ReadonlySet<string>;

  constructor() {
    this.set = new Set(DISPOSABLE_DOMAINS.map((d) => d.toLowerCase()));
  }

  isDisposable(email: string): boolean {
    const normalized = email.trim().toLowerCase();
    const at = normalized.lastIndexOf('@');
    if (at === -1 || at === normalized.length - 1) return false;
    const domain = normalized.slice(at + 1);
    return this.set.has(domain);
  }

  size(): number {
    return this.set.size;
  }
}
