/* a C++ class whose static method is called size: the generated class
 * must keep it instead of assigning its byte count to .size */
struct sized { int v; static int size(); int get() const; };
