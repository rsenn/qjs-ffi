#include <string>
#include <string_view>
#include <cstddef>

// extern "C" keeps the symbol names plain; the signatures are C++ all the same
extern "C" {
std::string sx_greet(std::string name) { return "hello " + name; }
std::string sx_join(const std::string& a, const std::string& b) { return a + b; }
std::string sx_repeat(int n) { return std::string(n, 'x'); }
size_t sx_length(const std::string& s) { return s.size(); }
void sx_shout(std::string& s) { s += "!!!"; }
void sx_fill(std::string* s) { if(s) *s = "a string long enough to leave the inline buffer"; }
int sx_split(const std::string& in, std::string* head, std::string& tail) {
  size_t i = in.find(':');

  if(i == std::string::npos) return 0;
  if(head) *head = in.substr(0, i);
  tail = in.substr(i + 1);
  return 1;
}
const std::string& sx_name() { static std::string n = "a static name that is long enough to live on the heap"; return n; }
const std::string* sx_none() { return nullptr; }
std::string_view sx_tail(std::string_view v) { return v.substr(1); }
size_t sx_vlen(std::string_view v) { return v.size(); }
}
