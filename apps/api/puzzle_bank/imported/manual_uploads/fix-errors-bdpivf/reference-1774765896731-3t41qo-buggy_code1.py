"""
PROBLEM STATEMENT:
A college canteen needs a program to calculate the total bill for a student.
1. The program should take a list of prices.
2. It must calculate the total sum of these prices.
3. If the total is more than 500, a 10% discount should be applied.
4. Finally, it should print the total and check if the student gets a 'Free Cookie' 
   (only for bills above 500).
   
FIX 8 ERRORS TO MAKE THE CODE RUN CORRECTLY.
"""

def calculate_bill(items)
    total = 0
    
    for price in items:
    total += price
    
    if total > 500:
        print("Discount Applied!")
        final_price = total - (total * 0.1)
    else:
        final_price = Total
        
    print("Your total is: " + final_price)
    return final_price

# Customer's order prices
order_list = [150, 200, "100", 300]

# Call the function
calculate_bill(order_list)

if final_price < 100:
    print("Bonus: Free Cookie!")