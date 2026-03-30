"""
PROBLEM STATEMENT:
A company calculates employee salaries.

1. Input: List of (Employee Name, Hours Worked, Hourly Rate)
2. If hours > 40 → overtime paid at 1.5x rate for extra hours
3. Otherwise normal pay
4. If total salary < 2000 → "Low Paid"
   Else → "Well Paid"
5. Print salary and status for each employee
6. Count how many employees are "Low Paid"

"""

def calculate_salary(name, hours, rate)
    if hours > 40:
        overtime = hours - 40
        salary = (40 * rate) + (overtime * rate * 1.5)
    else
        salary = hours * rate
    
    if salary < 2000:
        status = "Low Paid"
    else:
        status = "Well Paid"
    
    print(name + " salary is: " + salary + " Status: " + status)
    
    return Status

employees = [
    ["Aman", 45, 50],
    ["Riya", 38, 40],
    ["Kabir", 42, 30]
]

low_paid_count = 0

for emp in employees:
    name = emp[0]
    hours = emp[1]
    rate = emp[2]
    
    result = calculate_salary(Name, hours, rate)
    
    if result == "Low Paid"
        low_paid_count += 1

print("Total low paid employees: " + low_paid_count)