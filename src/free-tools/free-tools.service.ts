// ===================================================
// Free Tools Service - Uses Agent Sessions for Number Checking
// ===================================================
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { WhatsappService } from 'src/agentModules/whatsapp/whatsapp.service';
import { NumberCheckerResponseDto } from './dto/number-checker.dto';

// Country code mapping (common codes)
const COUNTRY_CODES: Record<string, string> = {
    '1': 'US/CA',
    '7': 'RU',
    '20': 'EG',
    '27': 'ZA',
    '30': 'GR',
    '31': 'NL',
    '32': 'BE',
    '33': 'FR',
    '34': 'ES',
    '36': 'HU',
    '39': 'IT',
    '40': 'RO',
    '41': 'CH',
    '43': 'AT',
    '44': 'GB',
    '45': 'DK',
    '46': 'SE',
    '47': 'NO',
    '48': 'PL',
    '49': 'DE',
    '51': 'PE',
    '52': 'MX',
    '53': 'CU',
    '54': 'AR',
    '55': 'BR',
    '56': 'CL',
    '57': 'CO',
    '58': 'VE',
    '60': 'MY',
    '61': 'AU',
    '62': 'ID',
    '63': 'PH',
    '64': 'NZ',
    '65': 'SG',
    '66': 'TH',
    '81': 'JP',
    '82': 'KR',
    '84': 'VN',
    '86': 'CN',
    '90': 'TR',
    '91': 'IN',
    '92': 'PK',
    '93': 'AF',
    '94': 'LK',
    '95': 'MM',
    '212': 'MA',
    '213': 'DZ',
    '216': 'TN',
    '218': 'LY',
    '220': 'GM',
    '221': 'SN',
    '234': 'NG',
    '254': 'KE',
    '255': 'TZ',
    '256': 'UG',
    '260': 'ZM',
    '263': 'ZW',
    '351': 'PT',
    '352': 'LU',
    '353': 'IE',
    '354': 'IS',
    '358': 'FI',
    '370': 'LT',
    '371': 'LV',
    '372': 'EE',
    '373': 'MD',
    '374': 'AM',
    '375': 'BY',
    '380': 'UA',
    '381': 'RS',
    '385': 'HR',
    '386': 'SI',
    '387': 'BA',
    '420': 'CZ',
    '421': 'SK',
    '880': 'BD',
    '886': 'TW',
    '960': 'MV',
    '961': 'LB',
    '962': 'JO',
    '963': 'SY',
    '964': 'IQ',
    '965': 'KW',
    '966': 'SA',
    '967': 'YE',
    '968': 'OM',
    '971': 'AE',
    '972': 'IL',
    '973': 'BH',
    '974': 'QA',
    '975': 'BT',
    '976': 'MN',
    '977': 'NP',
    '992': 'TJ',
    '993': 'TM',
    '994': 'AZ',
    '995': 'GE',
    '996': 'KG',
    '998': 'UZ',
};

@Injectable()
export class FreeToolsService {
    private readonly logger = new Logger(FreeToolsService.name);

    constructor(private readonly whatsappService: WhatsappService) { }

    /**
     * Detect country from phone number
     */
    private detectCountry(digitsOnly: string): {
        countryCode: string;
        countryName: string;
        nationalNumber: string;
    } {
        let countryCode = '';
        let countryName = 'Unknown';
        let nationalNumber = digitsOnly;

        // Check for 3-digit country codes first
        if (COUNTRY_CODES[digitsOnly.substring(0, 3)]) {
            countryCode = digitsOnly.substring(0, 3);
            countryName = COUNTRY_CODES[countryCode];
            nationalNumber = digitsOnly.substring(3);
        }
        // Check for 2-digit country codes
        else if (COUNTRY_CODES[digitsOnly.substring(0, 2)]) {
            countryCode = digitsOnly.substring(0, 2);
            countryName = COUNTRY_CODES[countryCode];
            nationalNumber = digitsOnly.substring(2);
        }
        // Check for 1-digit country codes
        else if (COUNTRY_CODES[digitsOnly.substring(0, 1)]) {
            countryCode = digitsOnly.substring(0, 1);
            countryName = COUNTRY_CODES[countryCode];
            nationalNumber = digitsOnly.substring(1);
        }

        return { countryCode, countryName, nationalNumber };
    }

    /**
     * Check if a phone number is registered on WhatsApp using an agent's session
     */
    async checkNumber(
        agentId: string,
        phoneNumber: string,
    ): Promise<NumberCheckerResponseDto> {
        // Validate agentId
        if (!agentId) {
            throw new BadRequestException('agentId is required');
        }

        // Clean the phone number - remove all non-digit characters
        const digitsOnly = phoneNumber.replace(/\D/g, '');

        // Basic validation
        if (digitsOnly.length < 7 || digitsOnly.length > 15) {
            const { countryCode, countryName, nationalNumber } =
                this.detectCountry(digitsOnly);
            return {
                isValid: false,
                isOnWhatsApp: false,
                formattedNumber: phoneNumber,
                countryCode,
                countryName,
                nationalNumber,
                error: 'Phone number must be between 7 and 15 digits',
            };
        }

        const formattedNumber = `+${digitsOnly}`;
        const { countryCode, countryName, nationalNumber } =
            this.detectCountry(digitsOnly);

        try {
            // Use the WhatsappService to check the number
            const result = await this.whatsappService.checkNumberOnWhatsApp(
                agentId,
                phoneNumber,
            );

            return {
                isValid: true,
                isOnWhatsApp: result.exists,
                formattedNumber,
                countryCode,
                countryName,
                nationalNumber,
                whatsappJid: result.jid,
            };
        } catch (error: any) {
            this.logger.error(`Error checking number: ${error.message}`);

            // Return error response
            return {
                isValid: true,
                isOnWhatsApp: false,
                formattedNumber,
                countryCode,
                countryName,
                nationalNumber,
                error: error.message || 'Could not verify WhatsApp status',
            };
        }
    }
}
