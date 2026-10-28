# rails runner ladder.rb <identifier>... — attaches Epic, Feature, User story, and Task and the
# Backlogs module to each project; API v3 cannot. Prints `PAW_LADDER <identifiers>`.
ladder = Type.where(name: ["Epic", "Feature", "User story", "Task"]).to_a
raise "ladder types missing: found #{ladder.map(&:name).join(', ')}" unless ladder.size == 4
ARGV.each do |identifier|
  project = Project.find_by!(identifier: identifier)
  ladder.each { |type| ProjectType.find_or_create_by!(project_id: project.id, type_id: type.id) }
  project.enabled_module_names = project.enabled_module_names | ["work_package_tracking", "backlogs"]
  project.save!
end
puts "PAW_LADDER #{ARGV.join(' ')}"
