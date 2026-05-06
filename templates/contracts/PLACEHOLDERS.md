# Contract Template Placeholders

All placeholders use the format `{{placeholder_name}}`.

| Name | Represents | Data source (Axira DB) | Type |
|---|---|---|---|
| `{{fze_license_number}}` | AXIRA TRADING FZE license number | static/company profile (not in current core tables) | string |
| `{{fze_address}}` | AXIRA TRADING FZE address | static/company profile (not in current core tables) | string |
| `{{auto_license_number}}` | AXIRA AUTO Algeria license number | static/company profile (not in current core tables) | string |
| `{{auto_address}}` | AXIRA AUTO Algeria address | static/company profile (not in current core tables) | string |
| `{{contract_reference}}` | Contract reference number | generated from `deals.id` (or document sequence) | string |
| `{{contract_date}}` | Contract signature date | `deals.date` | date |
| `{{receipt_reference}}` | Receipt reference number | generated from payment movement / `deals.id` | string |
| `{{receipt_date}}` | Receipt issue date | payment movement date (or generation date) | date |
| `{{fze_representative}}` | FZE authorized signatory name | static/company profile or `users.full_name` | string |
| `{{fze_position}}` | FZE representative position | static/company profile | string |
| `{{auto_representative}}` | Axira Auto representative name | static/company profile or local staff table | string |
| `{{auto_position}}` | Axira Auto representative position | static/company profile | string |
| `{{client_full_name}}` | Client full name | `clients.name` (fallback `deals.client_name`) | string |
| `{{client_id_number}}` | Client passport/ID number | client KYC field (outside current shared types) | string |
| `{{client_id_issue_date}}` | ID issuance date | client KYC field | date |
| `{{client_id_issue_place}}` | ID issuance place | client KYC field | string |
| `{{client_address}}` | Client address | client profile/KYC field | string |
| `{{client_phone}}` | Client phone | `clients.phone` | string |
| `{{client_email}}` | Client email | `clients.email` | string |
| `{{vehicle_brand}}` | Vehicle brand | `cars.brand` | string |
| `{{vehicle_model}}` | Vehicle model | `cars.model` | string |
| `{{vehicle_year}}` | Vehicle year | `cars.year` | number |
| `{{vehicle_trim}}` | Vehicle trim/variant | `cars.grade` (or catalog trim field) | string |
| `{{vehicle_exterior_color}}` | Exterior color | `cars.color` | string |
| `{{vehicle_interior_color}}` | Interior color | vehicle details extension / catalog field | string |
| `{{vehicle_mileage}}` | Mileage | `cars.mileage` | number |
| `{{vehicle_vin}}` | VIN/chassis number | `cars.vin` | string |
| `{{vehicle_engine}}` | Engine spec | `cars.engine` | string |
| `{{vehicle_transmission}}` | Transmission | `cars.transmission` | string |
| `{{vehicle_fuel}}` | Fuel type | `cars.fuel_type` | string |
| `{{vehicle_origin}}` | Country of origin | `cars.country_of_origin` | string |
| `{{vehicle_condition}}` | Vehicle condition (brand new/used) | `cars.condition` | string |
| `{{vehicle_options}}` | Extra options/specs | `cars.features` (joined text) or catalog options field | string |
| `{{vehicle_disclosures}}` | Disclosed used-vehicle conditions | inspection/notes field (`cars.body_issues` + deal notes) | string |
| `{{total_price_dzd}}` | Total contract amount in DZD | `deals.sale_amount` (or computed DZD total) | currency |
| `{{total_price_words}}` | Total amount in words | computed from `deals.sale_amount` | string |
| `{{deposit_amount_dzd}}` | Deposit amount in DZD | payment schedule (deal payment terms) | currency |
| `{{balance_amount_dzd}}` | Remaining amount in DZD | payment schedule (deal payment terms) | currency |
| `{{lead_time_days}}` | Estimated lead time in days | deal logistics field / template default | number |
| `{{amount_dzd}}` | Receipt amount in DZD | payment movement amount | currency |
| `{{amount_words}}` | Receipt amount in words | computed from receipt amount | string |
| `{{amount_usd}}` | USD equivalent for FZE records | computed from amount + FX rate | currency |
| `{{exchange_rate}}` | Applied DZD/USD exchange rate | FX snapshot at payment time | number |
| `{{payment_type}}` | Deposit/Balance/Full | payment record classification | string |
| `{{cumulative_paid_dzd}}` | Total paid so far | aggregate payments for `deals.id` | currency |
| `{{total_contract_dzd}}` | Total contract amount in DZD | `deals.sale_amount` | currency |
| `{{remaining_balance_dzd}}` | Outstanding balance | `deals.pending_dzd` | currency |

## Conditional placeholders and section flags (Docxtemplater syntax)

| Name | Represents | Data source (Axira DB) | Type |
|---|---|---|---|
| `{{is_brand_new}}` | Vehicle is brand new | derived from `cars.condition` | boolean |
| `{{is_used}}` | Vehicle is used | derived from `cars.condition` | boolean |
| `{{is_full_payment}}` | Full payment mode | derived from payment plan / `deals.pending_dzd == 0` | boolean |
| `{{is_deposit}}` | Deposit + balance mode | derived from payment plan / `deals.pending_dzd > 0` | boolean |
| `{{#is_brand_new}} ... {{/is_brand_new}}` | Include brand-new disclosure clause | generation logic from `{{is_brand_new}}` | conditional |
| `{{#is_used}} ... {{/is_used}}` | Include used/disclosed condition clause | generation logic from `{{is_used}}` | conditional |
| `{{#is_full_payment}} ... {{/is_full_payment}}` | Include full-payment terms | generation logic from `{{is_full_payment}}` | conditional |
| `{{#is_deposit}} ... {{/is_deposit}}` | Include deposit/balance terms | generation logic from `{{is_deposit}}` | conditional |
