# rails runner mint.rb <name> — mints an API token for the seeded admin; prints `PAW_TOKEN <value>`.
user = User.find_by!(login: "admin")
attrs = { user: user }
attrs[:token_name] = ARGV.fetch(0) if Token::API.method_defined?(:token_name=)
puts "PAW_TOKEN #{Token::API.create!(attrs).plain_value}"
