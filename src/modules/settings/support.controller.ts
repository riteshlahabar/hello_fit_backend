import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/auth.decorators';
import { SettingsService } from './settings.service';

/**
 * §3.11 and §5.11 — "display support contact information".
 *
 * The customer app's Support tab and the website's contact page both read
 * this. Public, for the same reason the catalog is: someone who cannot sign
 * in is exactly the person who needs the helpline.
 *
 * **Contact only** (client, 27-11-2026). §3.11's second half — "provide an
 * inquiry entry point" — would need a `support_inquiries` table, a create
 * route, the booking picker and an admin screen to answer them; the client
 * declined a support module on 23-11 and chose contact-only on 27-11, so
 * nothing here writes anything.
 *
 * Blank fields are omitted rather than sent empty: the app hides a row it
 * has no value for, and deciding that here means one rule instead of one per
 * surface.
 */
@Controller('support')
export class SupportController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('contact')
  contact() {
    const { phone, whatsapp, email, hours, address } =
      this.settings.get('support');

    return {
      data: {
        phone: blankToNull(phone),
        whatsapp: blankToNull(whatsapp),
        email: blankToNull(email),
        hours: blankToNull(hours),
        address: blankToNull(address),
      },
    };
  }
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
