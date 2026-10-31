type Opt = string | null | undefined;
/** Wi-Fi network. `auth`: `"WPA"`, `"WEP"`, `"nopass"` or null. */
export declare function wifi(ssid: string, password?: Opt, auth?: Opt, hidden?: boolean): string;
/** `mailto:` link with optional subject and body (percent-encoded). */
export declare function email(to: string, subject?: Opt, body?: Opt): string;
/** `SMSTO:` payload. */
export declare function sms(number: string, message?: Opt): string;
/** `tel:` link. */
export declare function tel(number: string): string;
/** `geo:` URI with up to 6 decimals; latitude is clamped to [-90, 90] and
 * longitude to [-180, 180]. */
export declare function geo(latitude: number, longitude: number): string;
export interface VCard {
    firstName?: Opt;
    lastName?: Opt;
    organization?: Opt;
    title?: Opt;
    phone?: Opt;
    email?: Opt;
    url?: Opt;
    address?: Opt;
    note?: Opt;
}
/** vCard 3.0 contact. */
export declare function vcard(card: VCard): string;
export interface CalendarEvent {
    summary?: Opt;
    /** e.g. "20261017T120000Z" */
    start?: Opt;
    end?: Opt;
    location?: Opt;
    description?: Opt;
}
/** iCalendar VEVENT. */
export declare function event(e: CalendarEvent): string;
export {};
